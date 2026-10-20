#include<iostream>
#include<vector>
using namespace std;
int main (){
  vector<int> vec;
  cout<<"Before push_back: "<<vec.size()<<endl;
  vec.push_back(52);
  vec.push_back(784);
  vec.push_back(498783);
  vec.push_back(55497);
  cout<<"After push_back: ";
  for (int i : vec){
  cout<<i<<" ";
  }
  cout<<"After pop_back: ";
  vec.pop_back();
  for (int i : vec){
    cout<<i<<" ";
  }
  return 0;
}