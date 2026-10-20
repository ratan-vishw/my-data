#include<iostream>
#include<climits>
using namespace std;
int main(){
  cout<<"Enter size: ";
  int size;
  cin>>size;
  int arry[size];
  int smallest = INT_MAX;
  int largest = -INT_MAX;
  for (int i = 0; i<size; i++){
    cout<<"Enter number "<<i<<": ";
    cin>>arry[i];
    if (arry[i] < smallest ){
      smallest = arry[i];
    }if (arry[i] > largest ){
      largest = arry[i];
    }
  }
  cout<<smallest<<endl;
  cout<<largest<<endl;
  return 0;
}