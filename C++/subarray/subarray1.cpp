#include<iostream>
#include<vector>
using namespace std;
int main (){
  vector<int> arry = {1, 2, 3, 4, 5, 6, 7, 8};
  int size = (arry.size() - 1);
  for (int i = 0; i<=size; i++){
    for (int j = i; j<=size; j++){
      for (int k = i; k<= j; k++){
        cout<<arry[k];
      }
      cout<<" ";
    }
    cout<<endl;
  }
  return 0;
}