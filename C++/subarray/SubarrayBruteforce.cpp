#include<iostream>
#include<vector>
using namespace std;
//brute force approch,
int main (){
  vector<int> arr = {1, 2, 3, 4, 5};
  int size = (arr.size() - 1);
  for (int st = 0; st<=size; st++){
    for (int end = st; end<= size; end++){
      for (int val = st; val<=end; val++){
        cout<<arr[val];
      }
      cout<<" ";
    }
    cout<<endl;
  }
  return 0;
}